// One fail-closed grammar for structured model objects across Groq's
// work planner and the reply reviewer. The only permitted Markdown wrapper
// is ONE complete json code fence, never prose, extra blocks or partial JSON.
export function parseStructuredModelObject(raw) {
  if(typeof raw!=='string'||!raw.trim()||raw.length>12000)
    throw Error('structured_model_object_invalid');
  const input=raw.trim();
  const fence=/^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(input);
  let value;
  try {value=JSON.parse(fence?fence[1]:input);} catch {throw Error('structured_model_object_invalid');}
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw Error('structured_model_object_invalid');
  return value;
}
