#!/bin/sh
set -e

echo "🚀 Starting OpenPlaud..."

# Wait for database to be ready
echo "⏳ Waiting for database..."
until node -e "
const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
sql\`SELECT 1\`.then(() => { 
  sql.end(); 
  process.exit(0); 
}).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "⏳ Database is unavailable - sleeping"
  sleep 2
done

echo "✅ Database is ready"

# Run migrations
echo "⏳ Running database migrations..."
if node src/db/migrate.js; then
  echo "✅ Migrations completed successfully"
else
  echo "❌ Migration failed"
  exit 1
fi

# Start the application
echo "🚀 Starting application..."
exec "$@"

