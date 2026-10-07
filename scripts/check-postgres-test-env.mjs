if (!process.env.KEEL_TEST_DATABASE_URL) {
  throw new Error(
    'test:postgres requires KEEL_TEST_DATABASE_URL pointing to a disposable PostgreSQL database',
  );
}
