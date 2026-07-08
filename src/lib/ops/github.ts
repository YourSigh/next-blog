import { randomUUID } from "node:crypto";
import { getGitHubConfig } from "./config";

export type OpsWorkflowKind = "deploy-api" | "build-android";

export type WorkflowRun = {
  id: number;
  name: string;
  title: string;
  status: string;
  conclusion: string | null;
  url: string;
  branch: string;
  commit: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
};

type GitHubRun = {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  head_branch: string;
  head_sha: string;
  actor?: { login?: string };
  created_at: string;
  updated_at: string;
};

function workflowName(kind: OpsWorkflowKind): string {
  const config = getGitHubConfig();
  return kind === "deploy-api" ? config.deployWorkflow : config.androidWorkflow;
}

async function githubRequest(path: string, init?: RequestInit): Promise<Response> {
  const { token } = getGitHubConfig();
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "next-blog-countdown-ops",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 300)}`);
  }

  return response;
}

export async function listWorkflowRuns(
  kind: OpsWorkflowKind,
  limit = 5,
): Promise<WorkflowRun[]> {
  const config = getGitHubConfig();
  const workflow = encodeURIComponent(workflowName(kind));
  const path = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/actions/workflows/${workflow}/runs?event=workflow_dispatch&per_page=${limit}`;
  const response = await githubRequest(path);
  const data = (await response.json()) as { workflow_runs?: GitHubRun[] };

  return (data.workflow_runs ?? []).map((run) => ({
    id: run.id,
    name: run.name,
    title: run.display_title,
    status: run.status,
    conclusion: run.conclusion,
    url: run.html_url,
    branch: run.head_branch,
    commit: run.head_sha.slice(0, 7),
    actor: run.actor?.login || "unknown",
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  }));
}

export async function dispatchWorkflow(kind: OpsWorkflowKind, username: string) {
  const config = getGitHubConfig();
  const workflow = encodeURIComponent(workflowName(kind));
  const requestId = randomUUID();
  const path = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/actions/workflows/${workflow}/dispatches`;

  await githubRequest(path, {
    method: "POST",
    body: JSON.stringify({
      ref: config.ref,
      inputs: {
        requested_by: username,
        request_id: requestId,
      },
    }),
  });

  return { requestId, ref: config.ref };
}

export async function cancelWorkflowRun(runId: number) {
  const config = getGitHubConfig();
  const path = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/actions/runs/${runId}/cancel`;

  await githubRequest(path, { method: "POST" });

  return { runId };
}
