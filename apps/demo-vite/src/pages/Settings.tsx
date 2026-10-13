import { useState } from 'react';

export function Settings() {
  const [deleted, setDeleted] = useState(false);
  return (
    <section>
      <h1>Settings</h1>
      <form id="profile" onSubmit={(e) => e.preventDefault()}>
        <label>
          Display name <input name="displayName" />
        </label>
        <button type="submit">Save profile</button>
      </form>
      <form
        id="delete-account"
        data-webmcp-risk="destructive"
        onSubmit={(e) => {
          e.preventDefault();
          setDeleted(true);
        }}
      >
        <button type="submit">Delete account</button>
      </form>
      <div role="status" data-testid="deleted">
        {deleted ? 'Account deleted' : ''}
      </div>
    </section>
  );
}
