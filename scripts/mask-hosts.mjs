// GitHub masks a secret's whole value in the log, never a part of it, and curl's error
// text can carry the bare hostname of a watched URL. Masking each hostname closes that.
const secrets = JSON.parse(process.env.SECRETS_CONTEXT ?? "{}");

for (const value of Object.values(secrets)) {
  if (
    typeof value === "string" &&
    URL.canParse(value) &&
    value.startsWith("https://")
  )
    console.log(`::add-mask::${new URL(value).hostname}`);
}
