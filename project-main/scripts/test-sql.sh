#!/bin/sh
# Uji skema SQL (RLS, kapasitas room, reconnect, keamanan topik Realtime) di Postgres lokal dengan stub Supabase.
# Syarat: server Postgres jalan; atur PGHOST/PGPORT/PGUSER. Contoh: PGHOST=/tmp PGPORT=5544 PGUSER=pgt sh scripts/test-sql.sh
set -e
cd "$(dirname "$0")/.."
DB=kynx_sqltest
psql -v ON_ERROR_STOP=1 -q postgres -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q $DB -f scripts/pg-stub.sql
psql -v ON_ERROR_STOP=1 -q $DB -f supabase/schema.sql
psql -v ON_ERROR_STOP=1 -q $DB -f scripts/test-sql.sql
