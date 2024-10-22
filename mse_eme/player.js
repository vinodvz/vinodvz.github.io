
var audioFragments = [
  "https://drm.streamdts.com/dtsx/dtse/dash/widevine/callout/media-audio-en-dtse.mp4"
];

var videoFragments = [
  "https://drm.streamdts.com/dtsx/dtse/dash/widevine/callout/media-video-avc1.mp4"
];

function MSELoadTrack(fragments, type, mediaSource, name, progressCallback) {
  return new Promise(function(resolve, reject) {
    var sourceBuffer;
    var curFragment = 0;

    function addNextFragment() {
      if (mediaSource.readyState == "closed") {
        return;
      }
      if (curFragment >= fragments.length) {
        resolve();
        progressCallback(100);
        return;
      }

      var fragmentFile = fragments[curFragment++];

      var req = new XMLHttpRequest();
      req.open("GET", fragmentFile);
      req.responseType = "arraybuffer";

      req.addEventListener("load", function() {
        progressCallback(Math.round(curFragment / fragments.length * 100));
        sourceBuffer.appendBuffer(new Uint8Array(req.response));
      });

      req.addEventListener("error", function(){
            console.log(name + " error fetching " + fragmentFile); reject();
        });
      req.addEventListener("abort", function(){
            console.log(name + " aborted fetching " + fragmentFile);  reject();
        });

      req.send(null);
    }

    sourceBuffer = mediaSource.addSourceBuffer(type);
    sourceBuffer.addEventListener("updateend", addNextFragment);
    addNextFragment();

  });
}

function bail(message)
{
  return function(err) {
    console.log(message + (err ? " " + err : ""));
  }
}

function ArrayBufferToString(arr)
{
  var str = '';
  var view = new Uint8Array(arr);
  for (var i = 0; i < view.length; i++) {
    str += String.fromCharCode(view[i]);
  }
  return str;
}

function StringToArrayBuffer(str)
{
  var arr = new ArrayBuffer(str.length);
  var view = new Uint8Array(arr);
  for (var i = 0; i < str.length; i++) {
    view[i] = str.charCodeAt(i);
  }
  return arr;
}

function Base64ToHex(str)
{
  var bin = window.atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  var res = "";
  for (var i = 0; i < bin.length; i++) {
    res += ("0" + bin.charCodeAt(i).toString(16)).substr(-2);
  }
  return res;
}

function HexToBase64(hex)
{
  var bin = "";
  for (var i = 0; i < hex.length; i += 2) {
    bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return window.btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

 function onLicenseRequestReadyStageChange(xhr, url, keyMessage, callback) {
   switch (xhr.readyState) {
   case 4:
     if (xhr.status === 200) {
       console.log('License request succeeded');

       if (xhr.responseType !== 'arraybuffer') {
         console.log('xhr response type was not set to the expected arraybuffer for license request');
       }
       callback(xhr.response);
     } else {
       console.log(`License Request XHR failed (${url}). Status: ${xhr.status} (${xhr.statusText})`);
     }
     break;
   }
 }

 function createLicenseXhr(url, keyMessage, callback) {
   const xhr = new XMLHttpRequest();

   xhr.open('POST', url, true);

   // Because we set responseType to ArrayBuffer here, callback is typed as handling only array buffers
   xhr.responseType = 'arraybuffer';
   xhr.onreadystatechange = onLicenseRequestReadyStageChange.bind(this, xhr, url, keyMessage, callback);
   return xhr;
 }

 function requestLicense(keyMessage, callback) {
    console.log('Requesting content license for key-system');

    const url = "https://widevine-dash.ezdrm.com/proxy?pX=DB6632";
    const xhr = createLicenseXhr(url, keyMessage, callback);
    console.log(`Sending license request to URL: ${url}`);
    const challenge = keyMessage;
    xhr.send(challenge);
 }

function UpdateSessionFunc(name) {
  return function(ev) {

   keySession = ev.target;
   requestLicense(ev.message, (data) => {
     console.log(`Received license data (length: ${data ? data.byteLength : data}), updating key-session`);
     keySession.update(data);
   });
 }
}

function KeysChange(event) {
  var session = event.target;
  console.log("keystatuseschange event on session" + session.sessionId);
  var map = session.keyStatuses;
  for (var entry of map.entries()) {
    var keyId = entry[0];
    var status = entry[1];
    var base64KeyId = Base64ToHex(window.btoa(ArrayBufferToString(keyId)));
    console.log("SessionId=" + session.sessionId + " keyId=" + base64KeyId + " status=" + status);
  }
}

var ensurePromise;

function EnsureMediaKeysCreated(video, keySystem, options, encryptedEvent) {
  // We may already have a MediaKeys object if we initialized EME for a
  // different MSE SourceBuffer's "encrypted" event, or the initialization
  // may still be in progress.
  if (ensurePromise) {
    return ensurePromise;
  }

  console.log("navigator.requestMediaKeySystemAccess("+ JSON.stringify(options) + ")");

  ensurePromise = navigator.requestMediaKeySystemAccess(keySystem, options)
    .then(function(keySystemAccess) {
      return keySystemAccess.createMediaKeys();
    }, bail(name + " Failed to request key system access."))

    .then(function(mediaKeys) {
      console.log(name + " created MediaKeys object ok");
      return video.setMediaKeys(mediaKeys);
    }, bail(name + " failed to create MediaKeys object"))

  return ensurePromise;
}

function SetupEME(video, keySystem, name, options)
{
  video.sessions = [];

  video.addEventListener("encrypted", function(ev) {
    console.log(name + " got encrypted event");

    EnsureMediaKeysCreated(video, keySystem, options, ev)
    .then(function() {
        console.log(name + " ensured MediaKeys available on HTMLMediaElement");
        var session = video.mediaKeys.createSession();
        video.sessions.push(session);
        session.addEventListener("message", UpdateSessionFunc(name));
        session.addEventListener("keystatuseschange", KeysChange);
        return session.generateRequest(ev.initDataType, ev.initData);
      }, bail(name + " failed to ensure MediaKeys on HTMLMediaElement"))

      .then(function() {
        console.log(name + " generated request");
      }, bail(name + " Failed to generate request."));
  });
}
