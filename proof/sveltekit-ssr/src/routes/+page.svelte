<script lang="ts">
import BookingDemo from "../lib/BookingDemo.svelte";
import type { PageData } from "./$types";
let { data }: { data: PageData } = $props();
</script>

<BookingDemo proof={data.proof} />
