import {describe,expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AxisTabs,ReferenceMark,SelectionPlate,Surface,WorkspaceTabs,motionTokens} from './motion';

describe('workspace navigation',()=>{
  it('exposes the selected workspace and one shared selection indicator',()=>{
    const html=renderToStaticMarkup(<WorkspaceTabs value="advanced" onChange={()=>{}}/>);
    expect(html).toContain('aria-label="Workspace"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Advanced/s);
    expect(html.match(/class="workspace-selection"/g)).toHaveLength(1);
    expect(html).toContain('AI Driving Coach');
  });
});

describe('floating surface semantics',()=>{
  it('preserves menu semantics and readable content on the first render',()=>{
    const html=renderToStaticMarkup(<Surface role="menu" aria-label="Session actions"><button role="menuitem">Edit details</button></Surface>);
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-label="Session actions"');
    expect(html).toContain('Edit details');
    expect(html).not.toContain('opacity:0');
    expect(html).not.toContain('inert');
  });
});

describe('shared selection motion',()=>{
  it('keeps every spring critically damped so selection never bounces',()=>{
    for(const spring of [motionTokens.spring,motionTokens.press]){
      const ratio=spring.damping/(2*Math.sqrt(spring.stiffness*spring.mass));
      expect(ratio).toBeGreaterThanOrEqual(.95);
      expect(ratio).toBeLessThanOrEqual(1.1);
    }
  });
  it('renders one decorative plate that never enters the accessibility tree',()=>{
    const html=renderToStaticMarkup(<SelectionPlate group="lap-plate" tone="reference"/>);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('selection-plate reference');
    expect(renderToStaticMarkup(<ReferenceMark/>)).toContain('reference-mark');
  });
  it('gives each axis switch its own selection pill so two copies cannot trade layout ids',()=>{
    const html=renderToStaticMarkup(<><AxisTabs value="distance" onChange={()=>{}}/><AxisTabs value="time" onChange={()=>{}}/></>);
    expect(html.match(/class="control-selection"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
  });
});
