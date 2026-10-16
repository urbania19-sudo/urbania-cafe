// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MenuClient from '../src/components/menu/MenuClient';

const item = { id:'4f1a0bc1-a561-47a4-a61d-04d9b4c7035d', name:'Test Coffee', description:'Test drink', price_paise:18000, is_veg:true, is_available:true, category_id:'coffee', image_url:null };
describe('customer menu', () => {
  it('adds an item to the cart when the customer taps Add', () => {
    render(<MenuClient table={{label:'Table 1',qr_token:'test-table-token'}} categories={[{id:'coffee',name:'Coffee'}]} items={[item]} />);
    fireEvent.click(screen.getByRole('button',{name:'Add'}));
    expect(screen.getByText('1 item')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox',{name:'Your name'}),{target:{value:'Namit'}});
    fireEvent.change(screen.getByRole('spinbutton',{name:'Number of people'}),{target:{value:'2'}});
    expect((screen.getByRole('button',{name:'Place Order'}) as HTMLButtonElement).disabled).toBe(false);
  });
});
