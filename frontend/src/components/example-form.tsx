import { exampleFormSchema, type ExampleFormValues } from "@ctp/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

/**
 * Reference stub form (§4 / §4.4). The resolver takes the zod schema straight
 * from `@ctp/shared` — the SAME schema the backend `validate` middleware uses —
 * so client and server validation can never drift. Copy this pattern for real
 * forms. It is built entirely from shadcn/Radix primitives (keyboard + ARIA for
 * free, per R14 / US-21); do not hand-roll inputs.
 */
export function ExampleForm() {
  const form = useForm<ExampleFormValues>({
    resolver: zodResolver(exampleFormSchema),
    defaultValues: { name: "", email: "" },
  });

  function onSubmit(values: ExampleFormValues) {
    // No backend call yet — this is a wiring reference. TODO(Rn).
    toast.success(`Validated via @ctp/shared: ${values.name}`);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input autoComplete="name" placeholder="Ada Lovelace" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" placeholder="ada@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  );
}
