// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginForm from '../src/components/auth/LoginForm';

const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn();
const mockMaybeSingle = vi.fn();
const mockEqUserId = vi.fn(() => ({
  maybeSingle: mockMaybeSingle,
}));
const mockSelect = vi.fn(() => ({
  eq: mockEqUserId,
}));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
}));

vi.mock('@/lib/supabase/browser', () => ({
  browserDb: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
    },
    from: mockFrom,
  }),
}));

describe('LoginForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...window.location,
        assign: vi.fn(),
        href: 'http://localhost:3000/admin/login',
        origin: 'http://localhost:3000',
      },
    });
  });

  it('renders owner portal headings when portal="owner"', () => {
    render(<LoginForm portal="owner" />);
    expect(screen.getByRole('heading', { name: /Owner/i })).toBeInTheDocument();
    expect(screen.getByText('Owner and administrator accounts only.')).toBeInTheDocument();
  });

  it('renders staff portal headings when portal="staff"', () => {
    render(<LoginForm portal="staff" />);
    expect(screen.getByRole('heading', { name: /Staff/i })).toBeInTheDocument();
    expect(screen.getByText('Staff accounts only.')).toBeInTheDocument();
  });

  it('displays generic error on invalid email or password', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    });

    render(<LoginForm portal="owner" />);

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign in securely/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    });
  });

  it('displays connection error when sign-in service cannot be reached', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSignInWithPassword.mockRejectedValueOnce(new Error('Failed to fetch'));

    render(<LoginForm portal="owner" />);

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign in securely/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not connect to the sign-in service.'
      );
    });
    consoleSpy.mockRestore();
  });

  it('rejects an account without an admin profile row and signs out', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'u-unregistered' } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    render(<LoginForm portal="owner" />);

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'nobody@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign in securely/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This account does not have café access permissions.'
      );
      expect(mockSignOut).toHaveBeenCalled();
      expect(window.location.assign).not.toHaveBeenCalled();
    });
  });

  it('blocks a staff account from signing into the owner portal and prompts for staff portal', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'u-staff-1' } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'staff' },
      error: null,
    });

    render(<LoginForm portal="owner" />);

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'staff@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign in securely/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This is a staff account. Please sign in via the Staff Portal.'
      );
      expect(mockSignOut).toHaveBeenCalled();
      expect(window.location.assign).not.toHaveBeenCalled();
    });
  });

  it('navigates owner to /admin on successful owner credentials', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'u-owner-1' } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'owner' },
      error: null,
    });

    render(<LoginForm portal="owner" />);

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign in securely/i }));

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith('/admin');
    });
  });

  it('navigates staff to /staff on successful staff credentials', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      data: { user: { id: 'u-staff-1' } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'staff' },
      error: null,
    });

    render(<LoginForm portal="staff" />);

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: 'staff@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Sign in securely/i }));

    await waitFor(() => {
      expect(window.location.assign).toHaveBeenCalledWith('/staff');
    });
  });
});
