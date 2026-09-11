"use client";

export default function ErrorPage() {
  return (
    <main role="alert" className="page-shell">
      <h1>This page is temporarily unavailable.</h1>
      <p>Reload the page to try again.</p>
      <button type="button" onClick={() => window.location.reload()}>
        Reload page
      </button>
      <a href="/">Go home</a>
    </main>
  );
}
