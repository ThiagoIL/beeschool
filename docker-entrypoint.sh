#!/bin/sh
# Ordem de subida: migrações -> conta master (se ainda não existir) -> aplicação.
# Se as migrações falharem, o container não sobe (evita rodar código novo com banco antigo).
set -e
echo "[bee-school] aplicando migrações do banco…"
node scripts/migrate.mjs
node scripts/bootstrap.mjs || echo "[bee-school] aviso: bootstrap da conta master não concluído (veja a mensagem acima)."
echo "[bee-school] iniciando a aplicação na porta ${PORT:-3000}…"
exec node server.js
