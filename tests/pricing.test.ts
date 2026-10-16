import { describe,it,expect } from 'vitest'; import { calculateLineTotal } from '../src/lib/pricing';
describe('pricing in paise',()=>{it('adds option cost before multiplying',()=>expect(calculateLineTotal({unitPricePaise:18000,optionPricePaise:2000,quantity:2})).toBe(40000));it('rejects invalid quantities',()=>expect(()=>calculateLineTotal({unitPricePaise:1,quantity:0})).toThrow());});
