import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { GMAIL_SCOPE } from "./config";
import type { Config } from "./config";
import type { AccountConnection } from "./store";

export interface GoogleAuth {
  authorization(state: string): Promise<{ url: string; verifier: string }>;
  exchange(code: string, verifier: string): Promise<AccountConnection>;
}

const profileSchema = z.object({ emailAddress: z.email() });
export const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expiry_date: z.number(),
  scope: z.string(),
  token_type: z.string().default("Bearer"),
});

export function googleAuth(config: Config): GoogleAuth {
  const client = () => new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.callback,
    transporterOptions: { timeout: 30_000, retry: false },
  });
  return {
    async authorization(state) {
      const oauth = client();
      const codes = await oauth.generateCodeVerifierAsync();
      if (!codes.codeChallenge) throw new Error("PKCE challenge missing");
      return {
        verifier: codes.codeVerifier,
        url: oauth.generateAuthUrl({
          access_type: "offline", prompt: "consent select_account", scope: [GMAIL_SCOPE],
          state, code_challenge: codes.codeChallenge, code_challenge_method: CodeChallengeMethod.S256,
        }),
      };
    },
    async exchange(code, verifier) {
      const oauth = client();
      const result = await oauth.getToken({ code, codeVerifier: verifier, redirect_uri: config.callback });
      const tokens = tokenSchema.parse(result.tokens);
      if (!tokens.scope.split(" ").includes(GMAIL_SCOPE)) throw new Error("Gmail permission missing");
      oauth.setCredentials(tokens);
      const response = await oauth.request<unknown>({ url: "https://gmail.googleapis.com/gmail/v1/users/me/profile" });
      const profile = profileSchema.parse(response.data);
      return { email: profile.emailAddress.toLowerCase(), credentials: JSON.stringify(tokens) };
    },
  };
}
