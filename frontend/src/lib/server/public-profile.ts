import "server-only";
import { cache } from "react";
import { GatewayError, gateway } from "./gateway";

export type PublicProfileContent = {
  name: string;
  headline?: string;
  bio?: string;
  college?: string;
  batch?: string;
  skills?: string[];
  links?: { platform: string; handle: string; url?: string }[];
};
export type PublicProfile = { slug: string; enabled: boolean; content: PublicProfileContent; updated_at?: string };

/** Anyone's enabled profile by its address; null when there is none. No sign-in is sent. */
export const publicProfile = cache(async (slug: string): Promise<PublicProfile | null> => {
  try {
    return await gateway<PublicProfile>(`/user/v1/public/profiles/${encodeURIComponent(slug)}`, { anonymous: true });
  } catch (error) {
    if (error instanceof GatewayError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
});

/** The signed-in student's own settings, enabled or not. */
export async function ownPublicProfile(principalId: string, tenantId: string): Promise<PublicProfile> {
  return gateway<PublicProfile>(`/user/v1/profiles/${principalId}/public?tenant_id=${tenantId}`);
}
