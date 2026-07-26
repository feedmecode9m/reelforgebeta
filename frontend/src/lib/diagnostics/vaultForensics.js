/**
 * Vault forensic trace helper — console diagnostics only.
 * @param {string} stage
 * @param {Record<string, unknown>} [detail]
 */
export function vaultForensic(stage, detail = {}) {
    console.info(`[VAULT_FORENSIC] ${stage}`, detail);
}
