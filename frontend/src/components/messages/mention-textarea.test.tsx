import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it } from "vitest";
import { MentionTextarea } from "./mention-textarea";

const JAMIE = { id: "018f3a4b-0000-7000-8000-0000000000a1", name: "Jamie Lee", email: "j@x.io" };
const JORDAN = { id: "018f3a4b-0000-7000-8000-0000000000b2", name: "Jordan Kim", email: "k@x.io" };
// The roster stores a blank name as "", not null.
const UNNAMED = { id: "018f3a4b-0000-7000-8000-0000000000c3", name: "", email: "sam@club.org" };

function Composer() {
  const [value, setValue] = useState("");
  return (
    <MentionTextarea
      aria-label="Message"
      value={value}
      onChange={setValue}
      candidates={[JAMIE, JORDAN, UNNAMED]}
      selfId={undefined}
    />
  );
}

function typeInto(text: string) {
  const box = screen.getByLabelText("Message");
  fireEvent.change(box, { target: { value: text, selectionStart: text.length } });
  return box;
}

it("moves the highlight with the arrow keys and picks it with Enter", async () => {
  render(<Composer />);
  const box = typeInto("hi @J");

  const options = screen.getAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual(["Jamie Lee", "Jordan Kim"]);
  // The highlight is announced from the textarea, where focus stays.
  expect(box).toHaveAttribute("aria-activedescendant", options[0]!.id);
  expect(options[0]).toHaveAttribute("aria-selected", "true");

  fireEvent.keyDown(box, { key: "ArrowDown" });
  expect(box).toHaveAttribute("aria-activedescendant", options[1]!.id);
  fireEvent.keyDown(box, { key: "ArrowDown" });
  // It wraps.
  expect(box).toHaveAttribute("aria-activedescendant", options[0]!.id);
  fireEvent.keyDown(box, { key: "ArrowUp" });
  fireEvent.keyDown(box, { key: "Enter" });

  await waitFor(() => expect(box).toHaveValue(`hi @[${JORDAN.id}] `));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("picks with Tab too, and closes without picking on Escape", async () => {
  render(<Composer />);
  let box = typeInto("@Ja");
  fireEvent.keyDown(box, { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(box).toHaveValue("@Ja");
  expect(box).not.toHaveAttribute("aria-activedescendant");

  // One more letter: React only reports a change when the value moves.
  box = typeInto("@Jam");
  fireEvent.keyDown(box, { key: "Tab" });
  await waitFor(() => expect(box).toHaveValue(`@[${JAMIE.id}] `));
});

it("leaves Enter alone when the list is closed", () => {
  render(<Composer />);
  const box = typeInto("no mention here");

  const unhandled = fireEvent.keyDown(box, { key: "Enter" });

  // Not prevented: the textarea still gets its newline.
  expect(unhandled).toBe(true);
});

it("lists a member with a blank name by email, and finds them by it", () => {
  render(<Composer />);

  typeInto("@");
  expect(screen.getByRole("option", { name: "sam@club.org" })).toBeInTheDocument();

  typeInto("@sam");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "sam@club.org",
  ]);
});
