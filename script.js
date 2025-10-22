document.getElementById("converterBtn").addEventListener("click", async () =>{
    const fileInput = document.getElementById("svgFile");
    const canvas = document.getElementById("canvas");
    const downloadLink = document.getElementById("downloadLink")

    if(!fileInput.files.length){
        alert("por favor selecione um arquivo Svg");
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = function (e){
        const svgData = e.target.result;
        const img = new Image();
    

    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    img.onload = function () {
        const width = img.width;
        const height = img.height;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");

        ctx.drawImage(img, 0, 0, width, height);

        const pngData = canvas.toDataURL("image/png");

        downloadLink.href = pngData;
        downloadLink.download = file.name.replace(".svg", ".png");
        downloadLink.style.display = "block";
        downloadLink.textContent = "Baixar PNG"

        URL.revokeObjectURL(url);
    
    };

    img.src = url;

    };

    reader.readAsText(file);

});