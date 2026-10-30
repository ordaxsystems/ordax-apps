// Structural quality gate. Semantic coherence requires a separate independent
// evidence-backed evaluator: word counts and lexical overlap are not semantics.
export const STORY_SCENE_BOUNDS=Object.freeze({min:75,max:110});
export const STORY_SYNTHESIS_BOUNDS=Object.freeze({min:320,max:450});
export const storyWordCount=text=>String(text||'').trim().split(/\s+/u).filter(Boolean).length;
const normalized=text=>String(text).normalize('NFC').replace(/\s+/gu,' ').trim().toLocaleLowerCase('pt-BR');
export function assessStoryQuality(sceneTexts,finalText){
  if(!Array.isArray(sceneTexts)||sceneTexts.length!==4)throw Error('story_quality_missing_four_scenes');
  if(sceneTexts.some(s=>typeof s!=='string'||!s.trim()))throw Error('story_quality_invalid_scene');
  if(typeof finalText!=='string'||!finalText.trim())throw Error('story_quality_invalid_synthesis');
  const sceneWords=sceneTexts.map(storyWordCount);
  const synthesisWords=storyWordCount(finalText);
  const violations=[];
  for(let i=0;i<sceneWords.length;i++){
    if(sceneWords[i]<STORY_SCENE_BOUNDS.min||sceneWords[i]>STORY_SCENE_BOUNDS.max)
      violations.push('scene_'+(i+1)+'_word_limit');
  }
  for(let i=0;i<sceneTexts.length;i++){
    for(let j=0;j<i;j++){
      if(normalized(sceneTexts[i])===normalized(sceneTexts[j]))
        violations.push('scene_'+(i+1)+'_duplicates_scene_'+(j+1));
    }
  }
  if(synthesisWords<STORY_SYNTHESIS_BOUNDS.min||synthesisWords>STORY_SYNTHESIS_BOUNDS.max)
    violations.push('synthesis_word_limit');
  return Object.freeze({passed:violations.length===0,sceneWords,synthesisWords,violations,
    semanticStatus:'not_evaluated',qualityLevel:'structural_only',
    sceneBounds:STORY_SCENE_BOUNDS,synthesisBounds:STORY_SYNTHESIS_BOUNDS});
}
