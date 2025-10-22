<?php

?>

<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="style.css">
    <title>Conversor SVG para PNG</title>
</head>
<body>
    
<div class = "container">
    <input type="file" id = "svgFile" accept = ".svg"/>
    <button id ="converterBtn">Converter</button>
    <canvas id = "canvas" style="display: none;"></canvas>
    <a id = "downloadLink" style="display: none;">Baixar PNG</a>
</div>


    <script src="script.js"></script>
</body>
</html>