const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}$/;

export function normalizeGitHubRepositoryUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 300 || value.trim() !== value || value.includes('%'))
    throw Error('orchestrator_github_repository_invalid');
  let url;
  try { url = new URL(value); }
  catch { throw Error('orchestrator_github_repository_invalid'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' ||
      url.username || url.password || url.port || url.search || url.hash)
    throw Error('orchestrator_github_repository_invalid');
  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) throw Error('orchestrator_github_repository_invalid');
  const [, owner, rawRepository] = match;
  const repository = rawRepository.toLowerCase().endsWith('.git')
    ? rawRepository.slice(0, -4) : rawRepository;
  if (!OWNER.test(owner) || !REPOSITORY.test(repository) || repository === '.' || repository === '..')
    throw Error('orchestrator_github_repository_invalid');
  return `https://github.com/${owner}/${repository}`;
}

export function appendRemoteRepositoryInstructions(content, repositoryUrl) {
  if (typeof content !== 'string') throw Error('orchestrator_provider_prompt_invalid');
  const repository = normalizeGitHubRepositoryUrl(repositoryUrl);
  if (!repository) return content;
  return `${content}\n\nOrdaX · repositório remoto deste projeto\n`+
    `Repositório alvo: ${repository}\n`+
    'Trabalhe somente por meio da integração GitHub realmente disponível nesta conversa do ChatGPT. ' +
    'Comece consultando o estado remoto atual e use evidências retornadas pelo GitHub. ' +
    'Nenhuma pasta local está conectada nesta etapa: não use outro repositório, clone local ou shell. ' +
    'Se a integração não estiver disponível, faltar permissão ou não puder executar a operação solicitada, ' +
    'pare e informe o bloqueio. Não afirme leitura, alteração, commit, teste ou publicação sem evidência correspondente.';
}
