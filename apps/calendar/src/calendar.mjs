export function monthMatrix(year,month,weekStartsOn=0){
  if(!Number.isInteger(year)||!Number.isInteger(month)||month<0||month>11)throw new TypeError("invalid calendar month");
  const first=new Date(year,month,1);
  const days=new Date(year,month+1,0).getDate();
  const offset=(first.getDay()-weekStartsOn+7)%7;
  const cells=Array(42).fill(null);
  for(let day=1;day<=days;day++)cells[offset+day-1]=day;
  return Object.freeze(cells);
}
export function shiftMonth(year,month,delta){
  const d=new Date(year,month+delta,1);
  return Object.freeze({year:d.getFullYear(),month:d.getMonth()});
}
