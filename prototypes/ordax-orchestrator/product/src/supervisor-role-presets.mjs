// Presentation-only role templates. No provider calls, prompts or side effects.
const roles=Object.freeze([
  Object.freeze({id:'none',name:'Sem papel definido',description:'Conversa livre. Nenhum agente é iniciado.',draft:''}),
  Object.freeze({id:'math-teacher',name:'Professor de Matemática',description:'Teste seguro: exercícios, contas e explicações passo a passo.',draft:'Organizar uma explicação de matemática passo a passo, conferir as contas e indicar como validar o resultado. Sem ferramentas externas nem ações automáticas.'}),
  Object.freeze({id:'ordax-architect',name:'Arquiteto OrdaX',description:'Preparação para analisar arquitetura, melhorias e correções da OrdaX.',draft:'Analisar uma necessidade arquitetural da OrdaX, levantar dependências, riscos e critérios de teste. Propor ações verificáveis, sem executar comandos nem modificar projetos automaticamente.'})
]);
const roleMap=new Map(roles.map(role=>[role.id,role]));
export const SUPERVISOR_ROLES=roles;
export function supervisorRole(id) {return roleMap.get(id)||roles[0];}
export function assertSupervisorRole(id) {
  if(typeof id!=='string'||!roleMap.has(id))throw Error('invalid_supervisor_role');
  return id;
}
