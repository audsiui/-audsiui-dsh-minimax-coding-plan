import { ACCOUNT_QUOTA_EXCEEDED_CODE, LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm';
import { catalogModelInfo, plainOptions, resolveAdapterOptions, } from '@deepseek-ai/dsh-llm-deepseek';
/**
 * Bind the credential to the Messages transport.
 *
 * @param ctx - context the provider is registered in; used only for logging.
 * @param account - the credential the requests authenticate with.
 * @param config - parsed plugin configuration.
 * @param endpoints - the configured region's origins.
 * @returns the three collaborators the provider registration takes.
 */
export function createMinimaxProviderBinding(ctx, account, config, endpoints) {
    const options = () => {
        const plain = plainOptions(config);
        return resolveAdapterOptions({ ...plain, baseURL: plain.baseURL ?? endpoints.inferenceOrigin });
    };
    const resolveAuth = async (connection) => {
        const token = await account.resolveToken(connection.baseURL);
        if (token === undefined) {
            throw new LlmError('Sign in to MiniMax to use the Coding Plan provider. Run the `llm-minimax-coding-plan` sign-in, or enable automatic sign-in.', 'ACCOUNT_SIGN_IN_REQUIRED');
        }
        return {
            headers: { Authorization: `Bearer ${token}` },
            onRequestError: async (error) => {
                if (!(error instanceof LlmError))
                    return error;
                if (error.code === QUOTA_EXCEEDED_CODE) {
                    return new LlmError(error.message, ACCOUNT_QUOTA_EXCEEDED_CODE, { ...error.failure, cause: error });
                }
                if (error.failure.status !== 401)
                    return error;
                // Drop the rejected token only while it is still the stored one, so a
                // late 401 from a superseded request cannot sign out a fresh session.
                try {
                    await account.rejectToken(token);
                }
                catch (error) {
                    ctx.logger.warn('minimax-coding-plan: could not retire the rejected token: %o', error);
                }
                return new LlmError('The MiniMax access token was rejected. Sign in again to continue.', 'ACCOUNT_TOKEN_INVALID', { ...error.failure, cause: error });
            },
        };
    };
    const discoverModels = async (provider) => {
        try {
            await resolveAuth(options());
        }
        catch (error) {
            // A signed-out account is a normal state, not a discovery failure:
            // report no models so the selector asks for sign-in instead of erroring.
            if (error instanceof LlmError && error.code === 'ACCOUNT_SIGN_IN_REQUIRED')
                return [];
            throw error;
        }
        return options().models.map(model => catalogModelInfo(provider, model));
    };
    return { options, resolveAuth, discoverModels };
}
//# sourceMappingURL=provider.js.map