module.exports = ({ env }) => ({
  connection: {
    client: 'postgres',
    connection: {
      host: env('DATABASE_HOST', 'tramway.proxy.rlwy.net'),
      port: env.int('DATABASE_PORT', 17915),
      database: env('DATABASE_NAME', 'railway'),
      user: env('DATABASE_USERNAME', 'postgres'),
      password: env('DATABASE_PASSWORD', 'EMtdVsxPoSHSSZybobovfqnxaWFwdFid'),
      ssl: {
        rejectUnauthorized: false // Untuk development, matikan verifikasi SSL
      },
    },
    debug: false,
  },
});