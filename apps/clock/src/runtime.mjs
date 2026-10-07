const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const VERSION = "0.2.0";
const STYLE_URL = new URL("../assets/clock.css", import.meta.url).href;

function assertLifecycle(value) {
  if (!value || value.schema !== SURFACE_SCHEMA || !value.localization) throw new TypeError("A compatible Surface render lifecycle is required");
  return value;
}
function labels(locale) {
  return String(locale || "").toLowerCase().startsWith("pt")
    ? {title:"Relógio",local:"Hora local",stopwatch:"Cronômetro",timer:"Temporizador",start:"Iniciar",pause:"Pausar",reset:"Zerar",minutes:"Min",seconds:"Seg",finished:"Concluído"}
    : {title:"Clock",local:"Local time",stopwatch:"Stopwatch",timer:"Timer",start:"Start",pause:"Pause",reset:"Reset",minutes:"Min",seconds:"Sec",finished:"Finished"};
}
async function styles(root){const d=root.ownerDocument;let link=d.querySelector('link[data-ordax-component-style="clock"]');if(link)return()=>{};link=d.createElement("link");link.rel="stylesheet";link.href=STYLE_URL;link.dataset.ordaxComponentStyle="clock";d.head.append(link);return()=>link.remove();}
function formatStopwatch(ms){const minutes=Math.floor(ms/60000),seconds=Math.floor((ms%60000)/1000),tenths=Math.floor((ms%1000)/100);return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}.${tenths}`;}
function formatTimer(ms){const total=Math.max(0,Math.ceil(ms/1000)),minutes=Math.floor(total/60),seconds=total%60;return `${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}`;}

function mountView(root,lifecycle){
  const d=root.ownerDocument,t=labels(lifecycle.localization.getLocale()),section=d.createElement("section");
  section.className="ordax-clock";
  section.innerHTML=`
    <header><h1>${t.title}</h1><p>${t.local}</p></header>
    <div class="ordax-clock__time" data-time>--:--:--</div>
    <div class="ordax-clock__date" data-date></div>
    <div class="ordax-clock__panels">
      <section class="ordax-clock__panel">
        <strong>${t.stopwatch}</strong><output data-stopwatch>00:00.0</output>
        <div><button type="button" data-sw-toggle>${t.start}</button><button type="button" data-sw-reset>${t.reset}</button></div>
      </section>
      <section class="ordax-clock__panel">
        <strong>${t.timer}</strong><output data-timer>00:00</output>
        <div class="ordax-clock__timer-inputs"><label>${t.minutes}<input type="number" min="0" max="999" value="1" data-min></label><label>${t.seconds}<input type="number" min="0" max="59" value="0" data-sec></label></div>
        <div><button type="button" data-timer-toggle>${t.start}</button><button type="button" data-timer-reset>${t.reset}</button></div>
        <span data-timer-state></span>
      </section>
    </div>`;
  root.replaceChildren(section);

  const time=section.querySelector("[data-time]"),date=section.querySelector("[data-date]");
  const sw=section.querySelector("[data-stopwatch]"),swToggle=section.querySelector("[data-sw-toggle]"),swReset=section.querySelector("[data-sw-reset]");
  const timer=section.querySelector("[data-timer]"),timerToggle=section.querySelector("[data-timer-toggle]"),timerReset=section.querySelector("[data-timer-reset]"),minInput=section.querySelector("[data-min]"),secInput=section.querySelector("[data-sec]"),timerState=section.querySelector("[data-timer-state]");
  let swRunning=false,swElapsed=0,swStarted=0;
  let timerRunning=false,timerRemaining=0,timerStarted=0;

  const configuredMs=()=>{const m=Math.max(0,Math.min(999,Number(minInput.value)||0)),s=Math.max(0,Math.min(59,Number(secInput.value)||0));return (m*60+s)*1000;};
  const currentTimerMs=()=>timerRunning?Math.max(0,timerRemaining-(performance.now()-timerStarted)):timerRemaining;
  const render=()=>{
    const now=new Date(),locale=lifecycle.localization.getLocale();
    time.textContent=new Intl.DateTimeFormat(locale,{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(now);
    date.textContent=new Intl.DateTimeFormat(locale,{dateStyle:"full"}).format(now);
    sw.textContent=formatStopwatch(swElapsed+(swRunning?performance.now()-swStarted:0));
    const remaining=currentTimerMs();
    timer.textContent=formatTimer(remaining);
    if(timerRunning&&remaining<=0){timerRunning=false;timerRemaining=0;timerToggle.textContent=t.start;timerState.textContent=t.finished;section.dataset.timerFinished="true";}
  };
  const tick=setInterval(render,100);render();

  const onSwToggle=()=>{if(swRunning){swElapsed+=performance.now()-swStarted;swRunning=false;swToggle.textContent=t.start;}else{swStarted=performance.now();swRunning=true;swToggle.textContent=t.pause;}};
  const onSwReset=()=>{swElapsed=0;swStarted=performance.now();render();};
  const resetTimer=()=>{timerRunning=false;timerRemaining=configuredMs();timerStarted=performance.now();timerToggle.textContent=t.start;timerState.textContent="";delete section.dataset.timerFinished;render();};
  const onTimerToggle=()=>{if(timerRunning){timerRemaining=currentTimerMs();timerRunning=false;timerToggle.textContent=t.start;}else{if(timerRemaining<=0)timerRemaining=configuredMs();if(timerRemaining<=0)return;timerStarted=performance.now();timerRunning=true;timerToggle.textContent=t.pause;timerState.textContent="";delete section.dataset.timerFinished;}render();};
  const onTimerReset=()=>resetTimer();
  const onTimerInput=()=>{if(!timerRunning)resetTimer();};

  swToggle.addEventListener("click",onSwToggle);swReset.addEventListener("click",onSwReset);timerToggle.addEventListener("click",onTimerToggle);timerReset.addEventListener("click",onTimerReset);minInput.addEventListener("input",onTimerInput);secInput.addEventListener("input",onTimerInput);resetTimer();

  return()=>{clearInterval(tick);swToggle.removeEventListener("click",onSwToggle);swReset.removeEventListener("click",onSwReset);timerToggle.removeEventListener("click",onTimerToggle);timerReset.removeEventListener("click",onTimerReset);minInput.removeEventListener("input",onTimerInput);secInput.removeEventListener("input",onTimerInput);};
}
export const componentRuntime=Object.freeze({schema:COMPONENT_RUNTIME_SCHEMA,componentId:"clock",version:VERSION,async mount({root,surfaceLifecycle}={}){if(!root?.ownerDocument)throw new TypeError("Clock requires a mount root");const lifecycle=assertLifecycle(surfaceLifecycle),releaseStyles=await styles(root);let releaseView=mountView(root,lifecycle);const unsubscribe=lifecycle.localization.subscribe(()=>{releaseView();releaseView=mountView(root,lifecycle);});return Object.freeze({destroy(){unsubscribe?.();releaseView?.();root.replaceChildren();releaseStyles();}});}});
