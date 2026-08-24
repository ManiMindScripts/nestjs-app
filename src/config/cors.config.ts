export interface CorsOptions {
  origin: string[];
  credentials: boolean;
}

export function buildCorsOptions(corsOrigin: string): CorsOptions {
  // NOTE: credentials:true with a '*' origin is rejected by browsers and
  // would silently break credentialed requests; CORS_ORIGIN must always list
  // explicit origins in production.
  return {
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  };
}
