/**
 * @param value - a caught value.
 * @returns true when the value carries a Remote failure's marker.
 */
export function isRemoteFailure(value) {
    return typeof value === 'object'
        && value !== null
        && value.isDSHRemoteError === true
        && typeof value.code === 'string';
}
//# sourceMappingURL=isRemoteFailure.js.map