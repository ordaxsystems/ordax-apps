// Pure bounded presentation for the Studio/Platform Relay's existing event feed.
// The Relay remains the sole authority for receipts; this is NOT a new queue,
// database, history, or authorization service.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT=/^[a-z][a-z0-9-]{1,62}$/;
const STAGES=new Set(['submitted','central_received','provider_returned','provider_failed','completed']);
const VALID_STATUS=new Set(['submitted','received','response-ready','failed','completed']);
const maxText=(value,length=180)=>typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').slice(0,length):'';
export const CENTRAL_RECEIPT_PROJECTION_SCHEMA='ordax.central-receipt-projection/1';

export function projectCentralReceipts(events) {
  if(!Array.isArray(events)||events.length>130)
    return Object.freeze({schema:CENTRAL_RECEIPT_PROJECTION_SCHEMA,state:'unavailable',receipts:[]});
  const receipts=new Map();
  for(const event of events){
    if(!event||typeof event!=='object'||Array.isArray(event)||!STAGES.has(event.event))continue;
    if(!CLIENT.test(event.id)||!UUID.test(event.requestId))continue;
    const key=event.id+':'+event.requestId;
    let row=receipts.get(key);
    if(!row){
      row={deviceId:event.id,requestId:event.requestId,status:'submitted',
        requestPreview:'',resultPreview:'',received:false,providerReturned:false,delivered:false,
        updatedAt:'',httpStatus:null};
      receipts.set(key,row);
    }
    row.updatedAt=maxText(event.time,32);
    if(event.event==='submitted'){
      row.status='submitted';
      row.requestPreview=maxText(event.preview);
    }else if(event.event==='central_received'){
      row.received=true;
      row.status='received';
      if(!row.requestPreview)row.requestPreview=maxText(event.preview);
    }else if(event.event==='provider_returned'){
      row.providerReturned=true;
      row.status='response-ready';
      row.resultPreview=maxText(event.preview);
    }else if(event.event==='provider_failed'){
      row.status='failed';
      row.resultPreview=maxText(event.preview);
    }else if(event.event==='completed'){
      row.delivered=true;
      row.httpStatus=Number.isInteger(event.httpStatus)&&event.httpStatus>=100&&event.httpStatus<=599?event.httpStatus:null;
      row.status=event.ok===true&&row.httpStatus===200?'completed':'failed';
      if(!row.resultPreview)row.resultPreview=maxText(event.preview);
    }
  }
  const result=[...receipts.values()].reverse().slice(0,100).map(row=>Object.freeze(row));
  return Object.freeze({schema:CENTRAL_RECEIPT_PROJECTION_SCHEMA,state:'laboratory',receipts:result});
}
export function centralReceiptSummary(value) {
  const x=value?.schema===CENTRAL_RECEIPT_PROJECTION_SCHEMA&&value.state==='laboratory'?value.receipts:[];
  return Object.freeze({
    completed:x.filter(r=>r.status==='completed'&&r.delivered).length,
    failed:x.filter(r=>r.status==='failed').length,
    pending:x.filter(r=>!r.delivered&&r.status!=='failed').length,
  });
}
