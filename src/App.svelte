<script>
  import Player from "./Player.svelte";
</script>

<style>
  main {
    width: 80%;
    padding: 20px;
    border: solid gray 1px;
    margin: 0 auto;
    background-color: wheat;
    margin: 10vh auto;
  }
  #controls-container {
    display: flex;
  }
  button {
    display: block;
    width: 100%;
    margin-top: 20px;
    border: solid salmon 1px;
    background-color: sandybrown;
    color: rgb(61, 56, 56);
    font-size: 20px;
    border-radius: 3px;
  }
</style>

<main>
  <h1>Magic The Gathering Counter</h1>
  <div id="controls-container">
    <Player />
    <Player />
  </div>
  <button>Start Game</button>
</main>
