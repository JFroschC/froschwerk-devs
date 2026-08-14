/**
 * Local SQLite access for the development harness.
 *
 * The application is intentionally local-first at this stage. The schema is
 * also expressed in db/schema.ts so the same relational model can later be
 * moved to D1 without changing the domain tables.
 */
export * from "./local";
