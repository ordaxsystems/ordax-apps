// Independent quality gate for the four witnessed GPT Web turns and the Groq
// synthesis. A successful HTTP request or GPT Run never implies a valid story.
export const STORY_SCENE_BOUNDS=Object.freeze({min:75,max:110});
export const STORY_SYNTHESIS_BOUNDS=Object.freeze({min:320,max:450});
export const storyWordCount=text=>String(text||'').trim().split(/\s+/u).filter(Boolean).length;
export function assessStoryQuality(sceneTexts,finalText){
  if(!Array.isArray(sceneTexts)||sceneTexts.length!==4)throw Error('story_quality_missing_four_scenes');
  const sceneWords=sceneTexts.map(storyWordCount);
  const synthesisWords=storyWordCount(finalText);
  const violations=[];
  for(let i=0;i<sceneWords.length;i++){
    if(sceneWords[i]<STORY_SCENE_BOUNDS.min||sceneWords[i]>STORY_SCENE_BOUNDS.max)
      violations.push('scene_'+(i+1)+'_word_limit');
  }
  if(synthesisWords<STORY_SYNTHESIS_BOUNDS.min||synthesisWords>STORY_SYNTHESIS_BOUNDS.max)
    violations.push('synthesis_word_limit');
  return Object.freeze({passed:violations.length===0,sceneWords,synthesisWords,violations,
    sceneBounds:STORY_SCENE_BOUNDS,synthesisBounds:STORY_SYNTHESIS_BOUNDS});
}
