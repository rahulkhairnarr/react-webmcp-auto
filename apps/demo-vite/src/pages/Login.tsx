import { useState } from 'react';

export function Login() {
  const [msg, setMsg] = useState('');
  return (
    <section>
      <h1>Sign in</h1>
      <form
        id="login"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          setMsg(`Welcome, ${String(data.get('username'))}!`);
        }}
      >
        <label htmlFor="username">Username</label>
        <input id="username" name="username" required minLength={3} autoComplete="username" />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
        <label>
          <input type="checkbox" name="remember" /> Remember me
        </label>
        <button type="submit">Log in</button>
      </form>
      <div role="status">{msg}</div>
    </section>
  );
}
