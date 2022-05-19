from IPython.display import display, HTML
import random


class FederPy:
    def __init__(self, indexFile, indexSource, mediaUrls=[], **viewParams):
        self.indexFile = indexFile
        self.indexSource = indexSource

        self.container = "feder-container-%s" % random.randint(0, 10000000)

        self.federjs = "https://unpkg.com/@zilliz/feder"
        # self.federjs = "http://192.168.0.101:12357/feder_esm.js"

        self.actionJs = ""
        self.searchParams = {}
        self.mediaUrls = mediaUrls
        self.viewParams = viewParams

    def getDiv(self):
        return '<div id="%s" />' % self.container

    def getInitJs(self):
        return """
import { Feder } from "%s"
// console.log(Feder)

const mediaUrls = [%s]
const mediaCallback = (rowId) => rowId in mediaUrls ? mediaUrls[rowId] : null

const feder = new Feder({
    filePath: "%s",
    source: "%s",
    domSelector: "#%s",
    viewParams: {
        ...%s,
        mediaCallback,
    }
})
        """ % (self.federjs, ",".join(["'%s'" % url for url in self.mediaUrls]), self.indexFile, self.indexSource, self.container, self.viewParams)

    def overview(self, isDisplay=True):
        self.actionJs = "feder.overview()"
        if isDisplay:
            self.showHtml()
        else:
            return self.getHtml()

    def searchById(self, targetId, isDisplay=True):
        self.actionJs = "feder.setSearchParams(%s)\nfeder.searchById(%s)" % (
            self.searchParams, targetId)
        if isDisplay:
            self.showHtml()
        else:
            return self.getHtml()

    def searchRandTestVec(self, isDisplay=True):
        self.actionJs = "feder.setSearchParams(%s)\nfeder.searchRandTestVec()" % self.searchParams
        if isDisplay:
            self.showHtml()
        else:
            return self.getHtml()

    def setSearchParams(self, searchParams):
        self.searchParams = searchParams

    def getJs(self):
        return """
%s
%s
        """ % (self.getInitJs(), self.actionJs)

    def getHtml(self):
        return """
<!DOCTYPE html>
<html>

<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="theme-color" content="#ffffff" />
  <title>Feder</title>
</head>

<body style="background: #000">
  %s
</body>

<script type="module">
%s
</script>

</html> 
""" % (self.getDiv(), self.getJs())

    def showHtml(self):
        display(HTML(self.getHtml()))
