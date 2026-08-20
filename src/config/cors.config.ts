export interface CorsOptions {
  origin: string[];
  credentials: boolean;
}

export function buildCorsOptions(corsOrigin: string): CorsOptions {
  return {
    origin: corsOrigin.split(',').map((origin) => origin.trim()),
    credentials: true,
  };
}
