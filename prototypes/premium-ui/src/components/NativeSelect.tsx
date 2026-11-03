// Adapted from shadcn/ui NativeSelect (MIT). See ../../THIRD_PARTY_NOTICES.md.
// Native semantics retained; TTT CSS replaces Tailwind/cn and the decorative icon.
import type {ComponentProps} from 'react';
export function NativeSelect({className='',...props}:ComponentProps<'select'>){return <div data-slot="native-select-wrapper" className="native-select-wrapper"><select data-slot="native-select" className={`native-select ${className}`} {...props}/><span aria-hidden="true">⌄</span></div>;}
export function NativeSelectOption(props:ComponentProps<'option'>){return <option data-slot="native-select-option" {...props}/>;}
