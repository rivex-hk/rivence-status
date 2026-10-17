export function githubClient({
  token = process.env.GITHUB_TOKEN,
  repository = process.env.GITHUB_REPOSITORY,
  apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com",
} = {}) {
  return async function request(path, init = {}) {
    const response = await fetch(`${apiUrl}/repos/${repository}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    if (!response.ok)
      throw new Error(
        `GitHub API ${init.method ?? "GET"} ${path.split("?")[0]}: ${response.status}`,
      );
    return response.json();
  };
}

export async function ensureLabels(request, names) {
  for (const name of names)
    await request("/labels", {
      method: "POST",
      body: JSON.stringify({ name }),
    }).catch(() => "the label already exists");
}
