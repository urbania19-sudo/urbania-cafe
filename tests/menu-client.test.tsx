// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MenuClient from '../src/components/menu/MenuClient';

const item = { id:'4f1a0bc1-a561-47a4-a61d-04d9b4c7035d', name:'Test Coffee', description:'Test drink', price_paise:18000, is_veg:true, is_available:true, category_id:'coffee', image_url:null };
describe('customer menu', () => {
  it('clearly marks demo menus as preview-only and prevents order submission', () => {
    render(<MenuClient demo table={{label:'Table 1',qr_token:'demo-table-1'}} categories={[{id:'coffee',name:'Coffee'}]} items={[item]} />);
    fireEvent.click(screen.getByRole('button',{name:'Add'}));
    fireEvent.click(screen.getByRole('button',{name:'Place Order'}));
    fireEvent.change(screen.getByRole('textbox',{name:'Your name'}),{target:{value:'Test Guest'}});
    expect(screen.getByText(/Demo mode — orders will not be sent to staff/i)).toBeTruthy();
    expect((screen.getByRole('button',{name:'Preview only'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Preview only'}));
    expect(screen.queryByText(/orders will not be sent to staff/i)).toBeTruthy();
  });

  it('adds an item to the cart when the customer taps Add', () => {
    render(<MenuClient table={{label:'Table 1',qr_token:'test-table-token'}} categories={[{id:'coffee',name:'Coffee'}]} items={[item]} />);
    fireEvent.click(screen.getByRole('button',{name:'Add'}));
    expect(screen.getByText('1 item')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Place Order'}));
    fireEvent.change(screen.getByRole('textbox',{name:'Your name'}),{target:{value:'Namit'}});
    fireEvent.change(screen.getByRole('spinbutton',{name:'Number of people'}),{target:{value:'2'}});
    expect((screen.getByRole('button',{name:'Send order to staff'}) as HTMLButtonElement).disabled).toBe(false);
  });

  describe('category navigation layout across viewports (320px, 375px, 768px, 1440px)', () => {
    const realCategories = [
      { id: 'sandwiches', name: 'Sandwiches' },
      { id: 'pizza', name: 'Pizza' },
      { id: 'burger', name: 'Burger' },
      { id: 'fries', name: 'Fries' },
      { id: 'starters', name: 'Starters' },
      { id: 'chinese', name: 'Chinese' },
      { id: 'garlic-bread', name: 'Garlic Bread' },
      { id: 'pasta', name: 'Pasta' },
      { id: 'noodles', name: 'Noodles' },
      { id: 'maggi', name: 'Maggi' },
      { id: 'mocktails', name: 'Mocktails' },
    ];

    const menuItems = [
      { id: 'm-1', name: 'Club Sandwich', description: 'Triple decker', price_paise: 22000, is_veg: true, is_available: true, category_id: 'sandwiches', image_url: null },
      { id: 'm-2', name: 'Margherita Pizza', description: 'Fresh basil', price_paise: 28000, is_veg: true, is_available: true, category_id: 'pizza', image_url: null },
      { id: 'm-3', name: 'Blue Lagoon Mocktail', description: 'Curacao & lemon', price_paise: 16000, is_veg: true, is_available: true, category_id: 'mocktails', image_url: null },
    ];

    const viewports = [320, 375, 768, 1440];

    viewports.forEach((width) => {
      it(`renders all category chips on a single horizontal line without text wrapping at ${width}px`, () => {
        window.innerWidth = width;
        window.innerHeight = 800;
        window.dispatchEvent(new Event('resize'));

        const { container } = render(
          <MenuClient
            table={{ label: 'Table 1', qr_token: 'test-token' }}
            categories={realCategories}
            items={menuItems}
          />
        );

        const scroller = container.querySelector('.category-scroller');
        expect(scroller).toBeInTheDocument();

        // Check All button
        const allTab = screen.getByRole('tab', { name: 'All' });
        expect(allTab).toBeInTheDocument();
        expect(allTab).toHaveAttribute('aria-selected', 'true');

        // Check each category chip is rendered
        realCategories.forEach((cat) => {
          const tab = screen.getByRole('tab', { name: cat.name });
          expect(tab).toBeInTheDocument();
        });

        // Filter by Pizza category
        const pizzaTab = screen.getByRole('tab', { name: 'Pizza' });
        fireEvent.click(pizzaTab);
        expect(pizzaTab).toHaveAttribute('aria-selected', 'true');
        expect(allTab).toHaveAttribute('aria-selected', 'false');

        // Margherita Pizza should be visible, Club Sandwich should be hidden
        expect(screen.getByText(/Margherita Pizza/i)).toBeInTheDocument();
        expect(screen.queryByText(/Club Sandwich/i)).toBeNull();

        // Filter by Mocktails
        const mocktailsTab = screen.getByRole('tab', { name: 'Mocktails' });
        fireEvent.click(mocktailsTab);
        expect(screen.getByText(/Blue Lagoon Mocktail/i)).toBeInTheDocument();
        expect(screen.queryByText(/Margherita Pizza/i)).toBeNull();

        // Filter back to All
        fireEvent.click(allTab);
        expect(screen.getByText(/Club Sandwich/i)).toBeInTheDocument();
        expect(screen.getByText(/Margherita Pizza/i)).toBeInTheDocument();
        expect(screen.getByText(/Blue Lagoon Mocktail/i)).toBeInTheDocument();
      });
    });
  });
});
