// Trusted App probe, evaluated only in the disposable, network-denied
// Electron renderer. Never accepts code or selector instructions from a model.
// It touches at most one control per category, then the entire renderer closes.
export function probeIsolatedHtmlControls(doc=globalThis.document) {
  const checks=[];
  const add=(id,status)=>checks.push({id,status});
  const summary=doc.querySelector('details > summary');
  if (!summary) add('details_toggle','not_applicable');
  else {
    const details=summary.parentElement,original=Boolean(details.open);
    try {
      summary.click();
      const toggled=Boolean(details.open)===!original;
      summary.click();
      add('details_toggle',toggled&&Boolean(details.open)===original?'passed':'failed');
    } catch { add('details_toggle','failed'); }
    finally {details.open=original;}
  }
  const buttons=[...doc.querySelectorAll('button[aria-controls][aria-expanded]')];
  const button=buttons.find(x=>!x.disabled&&
    doc.getElementById(x.getAttribute('aria-controls')||'') &&
    ['true','false'].includes(x.getAttribute('aria-expanded')));
  if (!button) add('aria_toggle','not_applicable');
  else {
    const original=button.getAttribute('aria-expanded');
    try {
      button.click();
      const moved=button.getAttribute('aria-expanded')===(original==='true'?'false':'true');
      button.click();
      add('aria_toggle',moved&&button.getAttribute('aria-expanded')===original?'passed':'failed');
    } catch { add('aria_toggle','failed'); }
    finally {button.setAttribute('aria-expanded',original);}
  }
  const inputs=[...doc.querySelectorAll('form input[required]')];
  const input=inputs.find(x=>x.willValidate&&!x.readOnly&&!x.disabled&&
    ['text','email','url','tel','number','search','password'].includes(x.type));
  if (!input) add('required_form','not_applicable');
  else {
    const original=input.value;
    try {
      input.value='';
      add('required_form',
        input.validity.valueMissing===true &&
        input.form?.checkValidity()===false?'passed':'failed');
    }catch{add('required_form','failed');}
    finally{input.value=original;}
  }
  const checked=checks.filter(c=>c.status!=='not_applicable').length;
  const passed=checks.filter(c=>c.status==='passed').length;
  const failed=checks.filter(c=>c.status==='failed').length;
  return {schema:'ordax.lab.isolated-html-controls.v1',scope:'bounded_local_dom',
    status:failed?'failed':checked?'passed':'not_applicable',
    checked,passed,failed,checks};
}

// The Store accepts only the fixed shape produced by the App-owned probe.
// In particular: no arbitrary interactions, model text, or success coercion.
export function normalizedHtmlControlChecks(value){
  if(value?.schema!=='ordax.lab.isolated-html-controls.v1'||
     value.scope!=='bounded_local_dom'||!Array.isArray(value.checks)||
     value.checks.length!==3)return null;
  const ids=['details_toggle','aria_toggle','required_form'];
  const allowed=new Set(['passed','failed','not_applicable']);
  if(value.checks.some((c,i)=>c?.id!==ids[i]||!allowed.has(c?.status)))return null;
  const checked=value.checks.filter(c=>c.status!=='not_applicable').length;
  const passed=value.checks.filter(c=>c.status==='passed').length;
  const failed=value.checks.filter(c=>c.status==='failed').length;
  const status=failed?'failed':checked?'passed':'not_applicable';
  if(value.checked!==checked||value.passed!==passed||value.failed!==failed||
     value.status!==status)return null;
  return Object.freeze({schema:value.schema,scope:value.scope,status,
    checked,passed,failed,checks:Object.freeze(value.checks.map(c=>
      Object.freeze({id:c.id,status:c.status})))});
}
