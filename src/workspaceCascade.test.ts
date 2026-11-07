import {describe,expect,it} from 'vitest';
import {cascadeTokens,formatCounter,parseCounter,planCascade} from './workspaceCascade';

const piece=(id:string,left:number,top:number,media=false)=>({id,left,top,media});

describe('workspace cascade plan',()=>{
  it('builds the page in reading order, row by row',()=>{
    const plan=planCascade([piece('below',0,300),piece('right',400,10),piece('left',0,0),piece('middle',200,4)]);
    expect(plan.map(step=>step.piece.id)).toEqual(['left','middle','right','below']);
  });
  it('starts at once and delays each later piece',()=>{
    const delays=planCascade([piece('a',0,0),piece('b',0,100),piece('c',0,200)]).map(step=>step.delay);
    expect(delays).toEqual([0,cascadeTokens.stagger,cascadeTokens.stagger*2]);
  });
  it('compresses long pages so the build never outlasts its budget',()=>{
    const plan=planCascade(Array.from({length:40},(_,i)=>piece(String(i),0,i*100)));
    expect(plan.at(-1)!.delay).toBeLessThanOrEqual(cascadeTokens.maxDelay);
    expect(plan.at(-1)!.delay+cascadeTokens.duration).toBeLessThanOrEqual(1000);
    expect(plan[1].delay).toBeGreaterThan(0);
  });
  it('keeps chart pointer coordinates true by never translating them',()=>{
    const [card,chart]=planCascade([piece('card',0,0),piece('chart',0,100,true)]);
    expect(card.rise).toBe(cascadeTokens.rise);
    expect(chart.rise).toBe(0);
  });
  it('plans nothing for an empty page',()=>{
    expect(planCascade([])).toEqual([]);
  });
});

describe('rolling numbers',()=>{
  it.each([
    '0:10.000','1:23.456','12:05.100','44.74','20','10 rpm','+0.123','-0.123','−0.123','1,234','12,345.6','98.25%','$42,410','47.3 mph','0.10 km',
  ])('lands on exactly the recorded text: %s',text=>{
    const parsed=parseCounter(text)!;
    expect(parsed).not.toBeNull();
    expect(formatCounter(parsed,parsed.value)).toBe(text);
  });
  it.each(['—','0','0.000','0 / 44.74','0–50 m','Lap 7','Not yet quantifiable','1:02:03.000','',' '])('leaves non-countable text alone: %j',text=>{
    expect(parseCounter(text)).toBeNull();
  });
  it('keeps the shape of the value on the way up',()=>{
    expect(formatCounter(parseCounter('1:23.456')!,61.5)).toBe('1:01.500');
    expect(formatCounter(parseCounter('12,345.6')!,1000)).toBe('1,000.0');
    expect(formatCounter(parseCounter('+0.123')!,0)).toBe('+0.000');
    expect(formatCounter(parseCounter('10 rpm')!,3.4)).toBe('3 rpm');
  });
});
