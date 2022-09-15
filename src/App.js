import React from 'react';
import { AgndTopic } from './AgndTopic';
import { Duration } from './duration';
import { pomodoro, hourdoro, jkflow } from './templates'
import { Input, ButtonGroup, ButtonIcon, ButtonMenu, MenuItem } from 'react-rainbow-components';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay, faPause, faPlus, faMinus, faAngleDown } from '@fortawesome/free-solid-svg-icons';


class Agnda extends React.Component {
  constructor(props) {
    super(props);

    let hashes = window.location.hash.split('/');
    if (hashes[0].length == 0) hashes = [];
    const noHash = hashes.length == 0
    let topics = []

    if (noHash) {
     topics = [
        { name: "LET'S", seconds: 5 * 60, elapsed: 0},
        { name: "MAKE", seconds: 10 * 60, elapsed: 0},
        { name: "SHIT", seconds: 5 * 60, elapsed: 0},
      ];
    }

    let minuteLocked = false;
    let duration = 10;

    for (var i=0; i<hashes.length; i++) {
      let name = decodeURI(hashes[i].replace('#',''));

      if (i==0 && name>=1) {
        minuteLocked = true;
        duration = name;
        continue;
      }

      if (!minuteLocked) {
        if (i%2==0) {
          topics.push({ name: name, seconds: 10 * 60, elapsed: 0});
        } else {
          topics.push({ name: name, seconds: 15 * 60, elapsed: 0});
        }
      } else {
        topics.push({ name: name, seconds: duration * 60, elapsed: 0});
      }
    }

    var saved = localStorage.getItem(window.location);
    this.state = saved ? JSON.parse(saved) : {
      topics: topics,

      // Currently Selected/Focused Topic
      currentNumber: 0,
      name: topics[0].name,
      seconds: topics[0].seconds,

      elapsed: 0,
      on: false,
      stampStart: null,
      interval: null,
      autoTopic: false
    }

    this.start = this.start.bind(this);
    this.toggle = this.toggle.bind(this);
    this.stop = this.stop.bind(this);
    this.updateTimes = this.updateTimes.bind(this);
    this.saveThisState = this.saveThisState.bind(this);
    this.updateTitle = this.updateTitle.bind(this);
    this.pomodoro = this.pomodoro.bind(this);
    this.hourdoro = this.hourdoro.bind(this);
    this.jkflow = this.jkflow.bind(this);
    this.reset = this.reset.bind(this);
    this.toTime = this.toTime.bind(this);
    this.toNumberTime = this.toNumberTime.bind(this);
    this.handleTopicClick = this.handleTopicClick.bind(this);
    this.handleEditName = this.handleEditName.bind(this);
    this.handleEditTime = this.handleEditTime.bind(this);
    this.handleChangeAutoTopic = this.handleChangeAutoTopic.bind(this);
    this.addNewTopic = this.addNewTopic.bind(this);
    this.deleteTopic = this.deleteTopic.bind(this);
    this.editorInput = null;

    this.handleKeyPress = this.handleKeyPress.bind(this);
  }


  handleKeyPress(e) {
    e.preventDefault()
    this.setState({currentKey: e.keyCode});

    if (e.target.type == 'text') return;

    if(e.keyCode === 32) {
      this.toggle();
      this.saveThisState()
      console.log('space pressed!');
    }
  }
  
  componentDidMount() {
    document.addEventListener('keydown', this.handleKeyPress);
    if (this.state.on) {
      this.updateTimes()
      this.start()
    }
  }
  
  componentWillUnmount() {
    document.removeEventListener('keydown', this.handleKeyPress);
  }
  
  
  start() {
    clearInterval(this.state.interval)
    let interval = setInterval(this.updateTimes, 1000);
    
    this.setState({
      on: true,
      stampStart: Date.now(),
      interval: interval
    });
  }
  
  updateTimes() {    
    const currentIndex = this.state.currentNumber;
    let currentTopic = this.state.topics[currentIndex];
    let stampNow = Date.now()
    const actualElapsed = Math.round((stampNow-this.state.stampStart)/1000)

    // updated elapsed counter
    currentTopic.elapsed += actualElapsed;

    console.log("currentTopic.elapsed")
    console.log(currentTopic.elapsed)
    console.log("this.state.elapsed")
    console.log(this.state.elapsed)
    console.log("this.state.stampStart")
    console.log(this.state.stampStart)

    // set current topic
    this.state.topics[currentIndex] = currentTopic;

    // updateStamp after addition
    this.setState({
      elapsed: actualElapsed,
      stampStart: Date.now()
    })
    // will change topics if elapsed is at the end of the topic
    this.autoChangeTopic();
    // update the title according to the current elapsed time
    this.updateTitle();

    // save state to local storage
    this.saveThisState()
  }

  saveThisState() {
    localStorage.setItem(window.location, JSON.stringify(this.state));
  }

  updateTitle() {
    let totalDuration = 0;
    let totalElapsed = 0

    // count duration total
    for (var k in this.state.topics)
      totalDuration += this.state.topics[k].seconds;
    
    for (var i in this.state.topics)
      totalElapsed += this.state.topics[i].elapsed

    if (totalDuration > 0)
      document.title = 
      this.toNumberTime(totalElapsed) + " / " +
      this.toTime(totalDuration) + " session | AGNDA";
  }

  autoChangeTopic() {
    if (this.state.autoTopic)
      this.shouldChangeTopic();
  }
  
  shouldChangeTopic() {
    let currentNumber = this.state.currentNumber;
    let topic = this.state.topics[currentNumber];
    
    if (topic.elapsed >= topic.seconds) {
      if (currentNumber < this.state.topics.length) {
        currentNumber += 1;
        
        let nextTopic = this.state.topics[currentNumber];
        this.setState({
          currentNumber: currentNumber,
          name: nextTopic.name,
          seconds: nextTopic.seconds,
          elapsed: nextTopic.elapsed,
          stampStart: Date.now()
        });
      } else {
        this.stop;
      }
    }
  }

  toggle() {
    this.state.on ? this.stop() : this.start();
  }
  
  stop() {
    clearInterval(this.state.interval);
    this.setState({
      on: false,
      stampStart: null,
      interval: null
    });
  }
  
  updateTopic(topic) {
    const currentNumber = this.state.currentNumber;
    this.state.topics[currentNumber] = topic;
    this.setState({
      name: topic.name,
      seconds: topic.seconds,
    });
  }

  syncElapsed() {
    const stampNow = Date.now()
    const actualElapsed = (stampNow-this.state.stampStart)/1000

    const currentIndex = this.state.currentNumber;
    let currentTopic = this.state.topics[currentIndex];

    currentTopic.elapsed += Math.round(actualElapsed)

    if (currentTopic.elapsed > this.state.elapsed) {
      this.setState({
        elapsed: currentTopic.elapsed,
        stampStart: Date.now()
      });
    }
  }
  
  buildAgenda() {
    const topics = this.state.topics;
    return topics.map((topic, index) => (
      <AgndTopic 
        class={ (index == this.state.currentNumber) ? 'selected' : '' } 
        number={ index } 
        name={ topic.name } 
        seconds={ topic.seconds } 
        elapsed={ topic.elapsed }
        onClick={ () => this.handleTopicClick(topic, index) } 
        onDoubleClick={ () => this.editorInput.focus() }
        isLast={ index == topics.length-1 }
        />
    ));
  }
  
  addNewTopic() {
    let topics = this.state.topics;

    let currentNumber = topics.push({
      name: 'New topic',
      seconds: 5 * 60,
      elapsed: 0
    }) - 1;
    
    this.setState({
      topics: topics
    });
    
    let topic = topics[currentNumber];
    
    this.setState({
      currentNumber: currentNumber,
      name: topic.name,
      seconds: topic.seconds,
      elapsed: 0
    });

    this.editorInput.focus();
  }
  
  deleteTopic() {
    let topics = this.state.topics;
    let currentNumber = this.state.currentNumber;
    
    topics.splice(this.state.currentNumber, 1);
    
    currentNumber -= currentNumber ? 1 : 0;
    
    const currentTopic = topics[currentNumber];
    
    this.setState({
      topics: topics,
    });

    console.log("currentNumber")
    console.log(currentNumber)
    console.log("currentTopic")
    console.log(currentTopic)
    
    this.setState({
      currentNumber: currentNumber,
      name: currentTopic.name,
      seconds: currentTopic.seconds
    });
  }
  
  pomodoro() {
    this.setState({
      topics: pomodoro
    });
    
    this.setState({
      currentNumber: 0,
      name: pomodoro[0].name,
      seconds: pomodoro[0].seconds
    });
  }
  
  hourdoro() {
    this.setState({
      topics: hourdoro
    });
    
    this.setState({
      currentNumber: 0,
      name: hourdoro[0].name,
      seconds: hourdoro[0].seconds
    });
  }

  jkflow() {
    this.setState({
      topics: jkflow
    });
    
    this.setState({
      currentNumber: 0,
      name: jkflow[0].name,
      seconds: jkflow[0].seconds
    });
  }

  reset() {
    this.setState({
      topics: this.state.topics.map(topic => ({...topic, elapsed: 0}))
    });
    
    this.setState({
      currentNumber: 0,
      name: this.state.topics[0].name, 
      seconds: this.state.topics[0].seconds,
      elapsed: 0
    });
  }


  toTime(scnds) {
    const mins = Math.floor( scnds / 60 );
    let secs = scnds % 60;

    let minutes = (mins == 1) ? mins + " minute" : mins + "-minute";
    let seconds = (secs == 1) ? secs + " second" : secs + "-second";

    if (mins < 1)
      return seconds;
    else if (secs > 0)
      return minutes + " and " + seconds;
    else
      return minutes;
  }

  toNumberTime(seconds) {
    const mins = Math.floor( seconds / 60 );
    let secs = seconds % 60;
    secs = (secs < 10) ? ("0" + secs) : secs;
    return mins + ":" + secs;
  }
  
  
  handleTopicClick(topic, index) {
    if (index === this.state.currentNumber) return
    
    this.setState({
      currentNumber: index,
      name: topic.name,
      seconds: topic.seconds,
      elapsed: topic.elapsed,
      stampStart: Date.now()
    });
  }
  
  handleEditName(e) {
    const name = e.target.value;
    const currentNumber = this.state.currentNumber;
    
    this.state.topics[currentNumber].name = name;
    this.state.topics[currentNumber].seconds = this.state.seconds;
    
    this.setState({
      name: name,
      seconds: this.state.seconds
    });
  }
  
  handleEditTime(e) {
    const seconds = e.target.value * 60;
    const currentNumber = this.state.currentNumber;
    
    this.state.topics[currentNumber].name = this.state.name;
    this.state.topics[currentNumber].seconds = seconds;
    
    this.setState({
      name: this.state.name,
      seconds: seconds
    });
  }
  
  handleChangeAutoTopic(e) {
    const checked = e.target.checked;
    
    this.setState({
      autoTopic: checked
    });
  }
  
  
  render() {
    let on = this.state.on;
    let button = {
      controls:
        <ButtonGroup className="rainbow-m-around_medium controls">
          <ButtonIcon 
            onClick={ this.toggle }
            variant="border-filled"
            icon={ on ? <FontAwesomeIcon icon={faPause} /> : <FontAwesomeIcon icon={faPlay} />}
          />
          <ButtonIcon
            onClick={ this.addNewTopic }
            variant="border-filled"
            icon={<FontAwesomeIcon icon={faPlus} />}
          />
          <ButtonIcon
            onClick={ this.deleteTopic } 
            variant="border-filled"
            icon={<FontAwesomeIcon icon={faMinus} />}
          />
          <ButtonMenu
            menuAlignment="right"
            menuSize="x-small"
            icon={<FontAwesomeIcon icon={faAngleDown} />}
          >
            <MenuItem
              onClick={ this.pomodoro }
              label="Pomodoro-ize!" />
            <MenuItem
              onClick={ this.hourdoro }
              label="Hourdoro-ize!" 
            />
            <MenuItem
              onClick={ this.jkflow }
              label="Jim Kwik - Stages of flow" 
            />
            <MenuItem
              onClick={ this.reset }
              label="Reset"
            />
          </ButtonMenu>
        </ButtonGroup>
    }


    let part = {
      controls: button.controls,
      agenda: this.buildAgenda(),
      options:
        <div class="options">
          <input
            id="auto-change"
            type="checkbox"
            checked={ this.state.autoTopic }
            onChange={ this.handleChangeAutoTopic }
          />
          <label for="auto-change">Auto-change topic</label>
        </div>
    }


    let section = {
      agenda: <div class="agenda">
          { part.agenda }
          { part.controls }
          { part.options }
        </div>,
      
      editor:
      <div class="editor">
        <Input
          id="input-component-1"
          placeholder="topic or task"
          className="rainbow-m-vertical_x-large rainbow-p-horizontal_medium rainbow-m_auto topic"
          onChange={ this.handleEditName } 
          value={ this.state.name } 
          ref={elem => (this.editorInput = elem)}
        />
        <Duration 
          class="duration"
          onChange={ this.handleEditTime }
          value={ this.state.seconds }
        />
      </div>
    }


    return (
      <div class="meeting">
        
        { section.editor }
        { section.agenda }

      </div>
    );
  }
}

export default Agnda;
