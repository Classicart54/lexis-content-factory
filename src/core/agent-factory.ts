import type { AgentPorts } from './types.js';
import { ContentApiPublisher } from './content-api-publisher.js';
import { mockAgents } from './mock-agents.js';
import { NeuromediaClient } from './neuromedia-client.js';
import { NeuromediaInfographicsAgent } from './neuromedia-infographics-agent.js';
import { NeuromediaReviewerAgent } from './neuromedia-reviewer-agent.js';
import { NeuromediaSearchAgent } from './neuromedia-search-agent.js';
import { NeuromediaStructureAgent } from './neuromedia-structure-agent.js';
import { NeuromediaWriterAgent } from './neuromedia-writer-agent.js';
import type { ProjectKnowledge } from './project-knowledge.js';

export interface AgentFactoryOptions {
  neuromediaApiKey?: string;
  neuromediaBaseUrl?: string;
  neuromediaModel?: string;
  neuromediaTimeoutMs?: number;
  projectKnowledge?: ProjectKnowledge | null;
  contentApiUrl?: string;
  contentApiToken?: string;
}

export function createAgentPorts(options: AgentFactoryOptions): AgentPorts {
  const publisher = new ContentApiPublisher({ apiUrl: options.contentApiUrl, apiToken: options.contentApiToken, model: options.neuromediaModel });

  if (!options.neuromediaApiKey) {
    return options.contentApiUrl && options.contentApiToken ? { ...mockAgents, publishMaterial: (request, draft) => publisher.publish(request, draft) } : mockAgents;
  }

  const client = new NeuromediaClient({
    apiKey: options.neuromediaApiKey,
    baseUrl: options.neuromediaBaseUrl,
    model: options.neuromediaModel,
    timeoutMs: options.neuromediaTimeoutMs,
  });
  const searchAgent = new NeuromediaSearchAgent(client, options.projectKnowledge || null);
  const structureAgent = new NeuromediaStructureAgent(client, options.projectKnowledge || null);
  const writerAgent = new NeuromediaWriterAgent(client, options.projectKnowledge || null);
  const infographicsAgent = new NeuromediaInfographicsAgent(client);
  const reviewerAgent = new NeuromediaReviewerAgent(client, options.projectKnowledge || null);

  return {
    ...mockAgents,
    runSearchAgent: (request) => searchAgent.run(request),
    runStructureAgent: (request, facts) => structureAgent.run(request, facts),
    runWriterAgent: (request, facts, structure) => writerAgent.run(request, facts, structure),
    runInfographicsAgent: (request, facts, draft) => infographicsAgent.run(request, facts, draft),
    runReviewAgent: (request, facts, draft, validationReport) => reviewerAgent.run(request, facts, draft, validationReport),
    publishMaterial: (request, draft) => publisher.publish(request, draft),
  };
}
