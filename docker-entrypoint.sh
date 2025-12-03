#!/bin/sh
set -e

echo "🚀 Starting OpenPlaud..."

echo "⏳ Running database migrations..."
bun src/db/migrate.ts

echo "🚀 Starting application..."
exec "$@"
