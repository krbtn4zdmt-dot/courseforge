import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` from rewriting CLAUDE.md with its agent-rules block.
  // CLAUDE.md already points at the version-matched docs.
  agentRules: false,
};

export default nextConfig;
