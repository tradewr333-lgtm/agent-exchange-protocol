// Ecosystem adapters for the Federation agent. Each returns external agents shaped:
//   { ext_id, name, framework, services:[], endpoint? }
// In production these would query the respective registries/APIs; here they return
// representative rosters so the bridge is runnable and testable offline.

const ROSTERS = {
  crewai: [
    { ext_id: 'crewai:researcher-01', name: 'CrewAI Researcher', services: ['research', 'analysis'] },
    { ext_id: 'crewai:writer-01', name: 'CrewAI Writer', services: ['content_writing'] },
  ],
  autogen: [
    { ext_id: 'autogen:coder-01', name: 'AutoGen Coder', services: ['backend_dev', 'smart_contract_dev'] },
  ],
  langchain: [
    { ext_id: 'langchain:analyst-01', name: 'LangChain Analyst', services: ['research', 'data_processing'] },
  ],
  openai: [
    { ext_id: 'openai:assistant-01', name: 'OpenAI Assistant', services: ['research', 'content_writing'] },
  ],
  mcp: [
    { ext_id: 'mcp:auditor-01', name: 'MCP Security Auditor', services: ['security_audit'] },
  ],
};

export const SUPPORTED_ECOSYSTEMS = Object.keys(ROSTERS);

export function listEcosystemAgents(ecosystem) {
  if (ecosystem === 'all' || ecosystem === undefined) {
    return SUPPORTED_ECOSYSTEMS.flatMap((name) => withFramework(name));
  }
  return withFramework(ecosystem);
}

function withFramework(ecosystem) {
  const roster = ROSTERS[ecosystem] ?? [];
  return roster.map((agent) => ({ ...agent, framework: ecosystem }));
}
