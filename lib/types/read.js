/** A read that failed, tagged with what kind of failure it was. */
export class ReadError extends Error {
    failure;
    code;
    /**
     * @param failure - which of the three kinds this was.
     * @param message - the service's own wording, kept intact for the surface.
     * @param code - the service's own status code, when it sent one.
     * @param options - the underlying transport error, when there was one.
     */
    constructor(failure, message, code = null, options) {
        super(message, options);
        this.failure = failure;
        this.code = code;
        this.name = 'ReadError';
    }
}
/**
 * Perform one authenticated JSON read and return the parsed object.
 *
 * @param client - the origin, the grant, and the transport.
 * @param request - the path, method, query, body, and label.
 * @returns the response body as a record.
 * @throws {ReadError} `auth` when refused, `rejected` when the service said no,
 *   `unreachable` when no usable answer arrived.
 */
export async function readJson(client, request) {
    const { origin, token } = client;
    const { path, query, body, label } = request;
    const method = request.method ?? (body === undefined ? 'GET' : 'POST');
    const search = query === undefined ? '' : `?${new URLSearchParams(query).toString()}`;
    // `body` is omitted rather than set to undefined: under
    // `exactOptionalPropertyTypes` an explicit undefined is not a valid
    // `BodyInit`, and a GET carrying `"undefined"` is not a GET either.
    const init = {
        method,
        headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/json',
            'content-type': 'application/json',
        },
    };
    if (body !== undefined)
        init.body = JSON.stringify(body);
    let response;
    try {
        response = await (client.fetchImpl ?? fetch)(`${origin}${path}${search}`, init);
    }
    catch (error) {
        throw new ReadError('unreachable', `could not reach the MiniMax ${label}: ${String(error)}`, null, { cause: error });
    }
    const text = await response.text();
    // Parsed before anything is decided, because the two origins report the same
    // condition in different places and neither signal is optional:
    //   the open platform answers HTTP 200 with `base_resp.status_code`,
    //   the agent origin answers HTTP 401 with an empty body.
    // A body that is not a JSON object is recorded as absent rather than thrown
    // on here, so a 401 carrying a login redirect is still recognised as a 401.
    let answer = null;
    try {
        const parsed = JSON.parse(text);
        if (parsed !== null && typeof parsed === 'object')
            answer = parsed;
    }
    catch {
        answer = null;
    }
    // The body speaks first when it speaks at all. A 401 that also carries a
    // business code is saying something more specific than "your token is bad" —
    // `1003 group-not-member` is an answer about membership, not about the
    // credential — and the surface acts on the difference, offering a retry where
    // a refusal would send the operator to re-sign-in for nothing.
    if (answer !== null) {
        const base = (answer.base_resp ?? {});
        if (base.status_code !== undefined && base.status_code !== 0) {
            throw new ReadError('rejected', `${label} error ${String(base.status_code)}: ${base.status_msg ?? 'unknown'}`, base.status_code);
        }
        const info = (answer.statusInfo ?? {});
        if (info.code !== undefined && info.code !== 0) {
            throw new ReadError('rejected', `${label} error ${String(info.code)}: ${info.message ?? 'unknown'}`, info.code);
        }
    }
    // Then the status class, which is how the agent origin says it.
    if (response.status === 401) {
        throw new ReadError('auth', `the MiniMax grant was rejected by ${label} (HTTP 401)`);
    }
    if (answer === null) {
        // An edge interstitial or a login redirect, not a business answer.
        // Reporting it as unreachable keeps the surface showing something
        // retryable rather than an empty result that reads as "no quota".
        throw new ReadError('unreachable', `${label} returned a non-JSON body (HTTP ${response.status})`);
    }
    return answer;
}
//# sourceMappingURL=read.js.map