<script>
  export let score;
  export let winningText;
  export let won;
  export let fontColor;
  export let gameOver = false;

  function minus() {
    console.log("minus 1");
  }

  function plus() {
    console.log("plus 1");
  }
</script>

<style>
  .player {
    flex-grow: 1;
  }
  .plus {
    background-color: seagreen;
  }
  .minus {
    background-color: brown;
  }
  button[disabled] {
    background-color: gray;
    pointer-events: none;
  }
  button {
    font-size: 20px;
    border-radius: 3px;
    width: 40px;
    color: white;
    font-family: monospace;
    font-weight: bold;
  }
</style>

<div style="color: {fontColor}" class="player">
  <h2>{score}</h2>
  <button on:click={plus} disabled={gameOver} class="plus">+</button>
  <button on:click={minus} disabled={gameOver} class="minus">-</button>
  {#if won}
    <h2>{winningText}</h2>
  {/if}
</div>
