import { createHmac } from "node:crypto";

/**
 * Hash de um token (sessão, link de senha) com a chave AUTH_SECRET: HMAC-SHA256 em hexadecimal.
 * O banco guarda só esse hash. Trocar a chave invalida todos os tokens já emitidos.
 */
export const hmacToken = (secret: string, token: string) => createHmac("sha256", secret).update(token).digest("hex");
