import React, { Component } from 'react';
import './App.css';
import { AgndTopic } from './agndtopic';
import { Duration } from './duration';


var pomodoro = [
  { name: 'Work', seconds: 25 * 60, elapsed: 0 },
  { name: 'Break', seconds: 5 * 60, elapsed: 0 },
  { name: 'Work', seconds: 25 * 60, elapsed: 0 },
  { name: 'Break', seconds: 5 * 60, elapsed: 0 },
  { name: 'Work', seconds: 25 * 60, elapsed: 0 },
  { name: 'Break', seconds: 5 * 60, elapsed: 0 },
  { name: 'Work', seconds: 25 * 60, elapsed: 0 },
  { name: 'Break', seconds: 15 * 60, elapsed: 0 },
];

var hourdoro = [
  { name: 'Warm up', seconds: 15 * 60, elapsed: 0 },
  { name: 'Deep focus', seconds: 15 * 60, elapsed: 0 },
  { name: 'Finish task!', seconds: 15 * 60, elapsed: 0 },
  { name: 'Break', seconds: 15 * 60, elapsed: 0 },
];


class Agnda extends React.Component {
  constructor(props) {
    super(props);

    let hashes = window.location.hash.split('/');
    if (hashes[0].length == 0) hashes = [];
    let topics = []

    if (hashes.length == 0) {
     topics = [
        { name: "Introductions", seconds: 5 * 60, elapsed: 0},
        { name: "Discussion", seconds: 10 * 60, elapsed: 0},
        { name: "Open Forum", seconds: 5 * 60, elapsed: 0},
      ];
    }

    let minuteLocked = false;
    let duration = 10;

    for (var i=0; i<hashes.length; i++) {
      let name = decodeURI(hashes[i].replace('#',''));

      if (i==0 && name>=5) {
        minuteLocked = true;
        duration = name;
        continue;
      }

      if (!minuteLocked) {
        if (i%2==0) topics.push({ name: name, seconds: 10 * 60, elapsed: 0})
          else
        topics.push({ name: name, seconds: 15 * 60, elapsed: 0});
      } else {
        topics.push({ name: name, seconds: duration * 60, elapsed: 0});
      }
    }

    this.state = {
      topics: topics,

      // Currently Selected/Focused Topic
      currentNumber: 0,
      name: topics[0].name,
      seconds: topics[0].seconds,

      elapsed: 0,
      on: false,
      interval: null,
      autoTopic: false
    }
    

    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.updateTime = this.updateTime.bind(this);
    this.pomodoro = this.pomodoro.bind(this);
    this.hourdoro = this.hourdoro.bind(this);
    this.reset = this.reset.bind(this);
    this.handleTopicClick = this.handleTopicClick.bind(this);
    this.handleEditName = this.handleEditName.bind(this);
    this.handleEditTime = this.handleEditTime.bind(this);
    this.handleChangeAutoTopic = this.handleChangeAutoTopic.bind(this);
    this.addNewTopic = this.addNewTopic.bind(this);
    this.deleteTopic = this.deleteTopic.bind(this);
  }
  
  
  start() {
    let interval = setInterval(this.updateTime, 1000);
    
    this.setState({
      on: true,
      interval: interval
    });
  }
  
  updateTime() {    
    const currentNumber = this.state.currentNumber;
    let topic = this.state.topics[currentNumber];
    
    topic.elapsed += 1;
    
    this.state.topics[currentNumber] = topic;
    
    this.setState({
      elapsed: this.state.elapsed+1
    });
    
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
          seconds: nextTopic.seconds
        });
      } else {
        this.stop;
      }
    }
  }
  
  stop() {
    clearInterval(this.state.interval);
    this.setState({
      on: false,
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
      topics: topics,
    });
    
    let topic = topics[currentNumber];
    
    this.setState({
      currentNumber: currentNumber,
      name: topic.name,
      seconds: topic.seconds
    });
  }
  
  deleteTopic() {
    let topics = this.state.topics;
    let currentNumber = this.state.currentNumber;
    
    topics.splice(this.state.currentNumber, 1);
    
    currentNumber -= 1;
    
    const currentTopic = topics[currentNumber];
    
    this.setState({
      topics: topics,
    });
    
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

  reset() {
    this.setState({
      topics: [
        { name: "Introductions", seconds: 5 * 60, elapsed: 0},
        { name: "Discussion", seconds: 10 * 60, elapsed: 0},
        { name: "Open Forum", seconds: 5 * 60, elapsed: 0},
      ]
    });
    
    this.setState({
      currentNumber: 0,
      name: this.state.topics[0].name, 
      seconds: this.state.topics[0].seconds,
      elapsed: 0
    });
  }
  
  
  handleTopicClick(topic, index) {
    this.setState({
      currentNumber: index,
      name: topic.name,
      seconds: topic.seconds
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
      onoff: <button onClick={ on ? this.stop : this.start }>{ on ? "Stop" : "Start" }</button>,
      
      newtopic: <button onClick={ this.addNewTopic }>+</button>,
      deletetopic: <button onClick={ this.deleteTopic }>-</button>,

      pomo: <button onClick={ this.pomodoro }>Pomodoro-ize!</button>,
      hour: <button onClick={ this.hourdoro }>Hourdoro-ize!</button>,
      reset: <button onClick={ this.reset }>Reset</button>
    }

    return (
      <div class="meeting">
        <div class="agenda">
          <div class="controls">
            { button.onoff }
            { button.newtopic }
            { button.deletetopic }
          </div>
          
          { this.buildAgenda() }

          <div class="templates">
            { button.pomo }
            { button.hour }
            { button.reset }
          </div>
          <input 
            id="auto-change"
            type="checkbox"
            checked={ this.state.autoTopic } 
            onChange={ this.handleChangeAutoTopic } 
            />
          <label for="auto-change">Auto-change topic</label>
        </div>
        <div class="editor">
          <input 
            type="text" 
            class="topic" 
            onChange={ this.handleEditName } 
            value={ this.state.name } 
            />
          <Duration 
            class="duration"
            onChange={ this.handleEditTime }
            value={ this.state.seconds }
            />
        </div>
      </div>
    );
  }
}

export default Agnda;
