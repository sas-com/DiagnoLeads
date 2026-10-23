-- Rollback of cms/migrations/sql/0001_initial.sql (#418). Run in the Supabase SQL Editor only to
-- undo it: removes the cms schema with every CMS table, user and article in it. The public schema
-- (the app's data) is not touched.
drop schema if exists "cms" cascade;
