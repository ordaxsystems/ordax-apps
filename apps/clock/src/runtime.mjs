import { createClockSession, formatStopwatch, formatTimer } from "./clock-session.mjs";

const COMPONENT_RUNTIME_SCHEMA = "ordax.component-runtime/1";
const SURFACE_SCHEMA = "ordax.surface-render-lifecycle/5";
const VERSION = "0.3.0";
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
function mountView(root,lifecycle,session){
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
  const initial = session.snapshot();
  minInput.value = String(Math.floor(initial.timerConfiguredMs / 60_000));
  secInput.value = String(Math.floor((initial.timerConfiguredMs % 60_000) / 1_000));

  const configuredMs = () => {
    const minutes = Math.max(0, Math.min(999, Number(minInput.value) || 0));
    const seconds = Math.max(0, Math.min(59, Number(secInput.value) || 0));
    return Math.round((minutes * 60 + seconds) * 1_000);
  };

  const render = () => {
    const now = new Date(), locale = lifecycle.localization.getLocale();
    const state = session.snapshot();
    time.textContent = new Intl.DateTimeFormat(locale, {hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(now);
    date.textContent = new Intl.DateTimeFormat(locale, {dateStyle:"full"}).format(now);
    sw.textContent = formatStopwatch(state.stopwatchElapsedMs);
    timer.textContent = formatTimer(state.timerRemainingMs);
    swToggle.textContent = state.stopwatchRunning ? t.pause : t.start;
    timerToggle.textContent = state.timerRunning ? t.pause : t.start;
    timerState.textContent = state.timerFinished ? t.finished : "";
    if (state.timerFinished) section.dataset.timerFinished = "true";
    else delete section.dataset.timerFinished;
  };

  const onSwToggle = () => { session.toggleStopwatch(); render(); };
  const onSwReset = () => { session.resetStopwatch(); render(); };
  const onTimerToggle = () => { session.toggleTimer(); render(); };
  const onTimerReset = () => { session.resetTimer(); render(); };
  const onTimerInput = () => { session.setTimerDuration(configuredMs()); render(); };

  swToggle.addEventListener("click",onSwToggle);swReset.addEventListener("click",onSwReset);timerToggle.addEventListener("click",onTimerToggle);timerReset.addEventListener("click",onTimerReset);minInput.addEventListener("input",onTimerInput);secInput.addEventListener("input",onTimerInput);
  render();
  const tick = setInterval(render,100);

  return()=>{clearInterval(tick);swToggle.removeEventListener("click",onSwToggle);swReset.removeEventListener("click",onSwReset);timerToggle.removeEventListener("click",onTimerToggle);timerReset.removeEventListener("click",onTimerReset);minInput.removeEventListener("input",onTimerInput);secInput.removeEventListener("input",onTimerInput);};
}
export const componentRuntime = Object.freeze({
  schema: COMPONENT_RUNTIME_SCHEMA,
  componentId: "clock",
  version: VERSION,
  async mount({root, surfaceLifecycle} = {}) {
    if (!root?.ownerDocument) throw new TypeError("Clock requires a mount root");
    const lifecycle = assertLifecycle(surfaceLifecycle);
    if (typeof lifecycle.localization.getLocale !== "function"
      || typeof lifecycle.localization.subscribe !== "function") {
      throw new TypeError("Clock requires the public localization port");
    }

    const releaseStyles = await styles(root);
    const session = createClockSession();
    let releaseView = null;
    let unsubscribe = null;
    try {
      releaseView = mountView(root, lifecycle, session);
      unsubscribe = lifecycle.localization.subscribe(() => {
        releaseView?.();
        releaseView = null;
        releaseView = mountView(root, lifecycle, session);
      });
      let destroyed = false;
      return Object.freeze({
        destroy() {
          if (destroyed) return;
          destroyed = true;
          unsubscribe?.();
          releaseView?.();
          root.replaceChildren();
          releaseStyles();
        },
      });
    } catch (error) {
      unsubscribe?.();
      releaseView?.();
      root.replaceChildren();
      releaseStyles();
      throw error;
    }
  },
});
